import { ApiRoot, Client1_13 as K8sClient } from 'kubernetes-client'
import Request, { config } from 'kubernetes-client/backends/request'
import { decodeBase64 } from './crypto'

interface SecretInfo {
    name: string
}

export interface ServiceAccountResponse {
    body: {
        secrets: SecretInfo[]
        items: unknown[]
    }
}

export interface SecretData {
    'ca.crt': string
    namespace: string
    token: string
}

export interface SecretResponse {
    body: {
        data: SecretData
    }
}

export async function getServiceToken(accountName?: string, client?: ApiRoot): Promise<string> {
    if (!client) {
        const mode = process.env.KUBERNETES_SERVICE_HOST ? 'cluster' : 'standalone'
        const K8S_OPTIONS = mode === 'cluster' ?
            { backend: new Request(config.getInCluster()) }
            : {}
        
        client = new K8sClient(K8S_OPTIONS)
    }

    if (!accountName) {
        accountName = process.env.SERVICE_ACCOUNT || 'sakura'
    }
    
    const svcAccRes: ServiceAccountResponse = await client.api.v1.ns('default').serviceaccounts(accountName).get()

    const secretName = svcAccRes.body.secrets[0].name
    const secretRes: SecretResponse = await client.api.v1.ns('default').secrets(secretName).get()

    return decodeBase64(secretRes.body.data.token)
}
