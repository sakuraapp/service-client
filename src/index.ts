import { EventEmitter } from 'events'
import WebSocket from 'ws'
import { v4 } from 'uuid'
import Axios, { AxiosInstance } from 'axios'
import { parseJSON } from './utils'
import { Handler, HandlerType, Packet, PacketData, PacketType } from './types'
import { getServiceToken as getSvcToken } from './utils/k8s'

export const getServiceToken = getSvcToken

export interface Options {
    name?: string
    host?: string
    port?: number
    path?: string
    token?: string
    autoReconnect?: boolean
    reconnectInterval?: number
    reconnectIntervalMultiplier?: number
}

export type HandlerFunction = (packet: Packet) => void

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 9998
export const DEFAULT_OPTIONS: Options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    path: '/',
    autoReconnect: true,
    reconnectInterval: 2000,
    reconnectIntervalMultiplier: 1,
}

export class Client extends EventEmitter {
    private id: string
    private opts: Options
    private socket: WebSocket
    private handlers: Handler[] = []
    private callbacks = 0
    private reconnectTries = 0
    private destroyed = false

    public api: AxiosInstance

    constructor(opts: Options = {}) {
        super()

        this.id = v4()
        this.opts = {
            ...DEFAULT_OPTIONS,
            ...opts,
        }

        this.initAxios()
    }

    private get protocol(): string {
        return this.opts.port === 443 ? 'https' : 'http'
    }

    private get wsProtocol(): string {
        return this.opts.port === 443 ? 'wss' : 'ws'
    }

    private get wsEndpoint(): string {
        return `${this.wsProtocol}://${this.opts.host}:${this.opts.port}${this.opts.path}`
    }

    private initAxios() {
        this.api = Axios.create({
            baseURL: `${this.protocol}://${this.opts.host}:${this.opts.port}`,
            headers: { 'Cache-Control': 'no-cache' },
        })

        this.api.interceptors.request.use((config) => {
            const token = this.opts.token

            if (token) {
                config.headers.Authorization = `Bearer ${token}`
            }

            return config
        })
    }

    private registerEvents() {
        this.socket.on('message', (data: string) => {
            const packet = parseJSON(data, null)

            if (packet) {
                this.handle(new Packet(packet, this))
            }
        })

        this.socket.on('error', (err) => {
            this.emit('error', err)
        })

        this.socket.on('close', (code) => {
            this.emit('close', code)

            if (this.opts.autoReconnect) {
                setTimeout(() => {
                    if (!this.destroyed) {
                        this.connect()
                    }
                }, ++this.reconnectTries * this.opts.reconnectInterval * this.opts.reconnectIntervalMultiplier)
            }
        })
    }

    private findHandler(name: string, type?: HandlerType) {
        return this.handlers.find(
            (handler) =>
                handler.name === name && (!type || handler.type === type)
        )
    }

    private handle(packet: Packet<unknown>) {
        let handler
        let index = -1

        if (packet.data.t === 'callback') {
            handler = this.findHandler(String(packet.data.i), 'callback')
            index = this.handlers.indexOf(handler)
        } else {
            handler = this.findHandler(packet.data.n, packet.data.t)
        }

        if (!handler) {
            return this.emit('error', new Error('Invalid packet'))
        }

        handler.handler(packet)

        if (index > -1) {
            this.handlers.splice(index, 1)
        }
    }

    public async connect(): Promise<void> {
        if (!this.opts.host) {
            this.opts.host = DEFAULT_HOST
        }

        if (!this.opts.port) {
            this.opts.port = DEFAULT_PORT
        }

        if (!this.opts.token) {
            try {
                this.opts.token = await getServiceToken()
            } catch (err) {
                this.opts.token = ''
            }
        }

        this.socket = new WebSocket(this.wsEndpoint, {
            headers: {
                Authorization: `Bearer ${this.opts.token}`,
            },
        })

        const onceOpen = () => {
            return new Promise((resolve) => this.socket.once('open', resolve))
        }

        this.registerEvents()

        await onceOpen()
        await this.call('auth/login', { s: this.opts.name })

        this.reconnectTries = 0
        this.emit('connect')
    }

    public destroy(): void {
        this.socket.close()
        this.destroyed = true
    }

    public send<T = unknown>(
        type: PacketType,
        path: string,
        data: unknown
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const parts = path.split('/')
            const id = `${this.id}-${this.callbacks++}`

            this.handlers.push({
                type: 'callback',
                handler: (packet: Packet<T>) => {
                    const data = packet.data.d as { status?: number }

                    if (typeof data.status !== 'undefined') {
                        if (data.status === 200) {
                            resolve(packet.data.d)
                        } else {
                            reject(new Error(`Response code: ${data.status}`))
                        }
                    } else {
                        resolve(packet.data.d)
                    }
                },
                name: id,
            })

            this.write({
                s: parts.shift(),
                n: parts.join('/'),
                d: data,
                i: id,
                t: type,
            })
        })
    }

    public call<T>(path: string, data?: unknown): Promise<T> {
        return this.send('call', path, data)
    }

    public watch<T>(path: string, data: unknown): Promise<T> {
        return this.send('watch', path, data)
    }

    public write<T>(data: PacketData<T>): void {
        this.socket.send(JSON.stringify(data))
    }

    public registerHandler(
        name: string,
        type: HandlerType,
        handler: HandlerFunction
    ): void {
        this.handlers.push({ name, handler, type })
    }

    public registerMethod(name: string, handler: HandlerFunction): void {
        this.registerHandler(name, 'call', handler)
    }

    public registerWatcher(name: string, handler: HandlerFunction): void {
        this.registerHandler(name, 'watch', handler)
    }
}
