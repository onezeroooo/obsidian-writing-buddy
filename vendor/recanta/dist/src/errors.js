export class RecantaError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "RecantaError";
        this.code = code;
    }
}
export function check(condition, code, message) {
    if (!condition)
        throw new RecantaError(code, message);
}
