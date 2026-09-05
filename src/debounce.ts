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
            timeoutId = setTimeout(async () => {
                timeoutId = undefined;
                try {
                    await fn();
                } catch (error) {
                    console.error('Debounced function error:', error);
                }
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
