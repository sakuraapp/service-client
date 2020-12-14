export function parseJSON<T>(str: string, def: T): string | T {
    let res

    try {
        res = JSON.parse(str)
    } catch(err) {
        res = def
    }

    return res
}
