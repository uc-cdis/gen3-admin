export type LogMessage = {
    id: number;
    message: string;
    type: string;
    timestamp: string;
    log: string;
    pod: string;
    container: string;
    unix: string;
    namespace: string;
}

export interface LogViewMessage {
    timestamp: number;
    message: string;
}
