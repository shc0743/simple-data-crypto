#!/usr/bin/env node
import readline from 'readline';

function askPassword(purpose) {
    return new Promise((resolve, reject) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stderr,
            terminal: true
        });

        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;

        process.stderr.write('Please enter ' + purpose + ': ');

        let password = '';
        let isResolved = false;

        stdin.on('data', (chunk) => {
            const char = chunk.toString();

            if (char === '\r' || char === '\n') {
                if (!isResolved) {
                    isResolved = true;

                    rl.close();
                    resolve(password);
                }
                return;
            }

            if (char === '\b' || char === '\x7f') {
                if (password.length > 0) {
                    password = password.slice(0, -1);

                }
                return;
            }
            
            // 处理Ctrl+C (退出)
            if (char === '\x03') {
                if (!isResolved) {
                    isResolved = true;
                    process.stderr.write('\n');
                    if (stdin.setRawMode) {
                        stdin.setRawMode(wasRaw);
                    }
                    rl.close();
                    reject(new Error('Cancelled'));
                }
                return;
            }

            password += char;

            process.stderr.write('\b*');
        });

        rl.on('error', (err) => {
            if (!isResolved) {
                isResolved = true;
                if (stdin.setRawMode) {
                    stdin.setRawMode(wasRaw);
                }
                reject(err);
            }
        });

        process.on('exit', () => {
            if (stdin.setRawMode && !isResolved) {
                stdin.setRawMode(wasRaw);
            }
        });
    });
}

async function main() {
    try {
        const password = await askPassword(process.argv[2] || process.argv[1] || 'data');
        process.stdout.write(password);
    } catch (error) {
        process.exit(1);
    }
}

main();
