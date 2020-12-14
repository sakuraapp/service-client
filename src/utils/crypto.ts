export function decodeBase64(input: string): string {
    const buf = Buffer.from(input, 'base64')

    return buf.toString('utf8')
}
