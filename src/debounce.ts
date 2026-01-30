export interface Debouncer {
    call: () => void;
    cancel: () => void;
}

export function debounce(
    fn: () => void | Promise<void>,
    delayMs: number
): Debouncer {
    let timeoutId: NodeJS.Timeout | undefined;

    return {
        call: () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(() => {
                timeoutId = undefined;
                fn();
            }, delayMs);
        },
        cancel: () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = undefined;
            }
        }
    };
}
