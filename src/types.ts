import { Client } from '.'

export type PacketType = 'call' | 'watch' | 'callback'

export interface PacketData<T = unknown> {
    s?: string // service name
    n?: string // action name
    t: PacketType // action type
    d?: T // data
    i: string // id used for callbacks
}

export class Packet<T = unknown> {
    public readonly data: PacketData<T>
    public readonly client: Client

    get type(): PacketType {
        return this.data.t
    }

    get service(): string {
        return this.data.s
    }

    constructor(data: PacketData<T>, client: Client) {
        this.data = data
        this.client = client
    }

    respond(data?: unknown): void {
        this.client.write({
            d: data,
            t: 'callback',
            s: this.data.s,
            i: this.data.i,
        })
    }
}

export type HandlerType = PacketType

export interface Handler {
    name: string
    type: HandlerType
    handler: (packet: Packet) => void
}
