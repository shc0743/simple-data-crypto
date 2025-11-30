#!/usr/bin/env node
import { program } from 'commander';
import inquirer from 'inquirer';
import { encrypt_data, decrypt_data, encrypt_file, decrypt_file, change_file_password } from 'simple-data-crypto';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CryptCLI {
    constructor() {
        this.setupProgram();
    }

    setupProgram() {
        program
            .name('sdc-cli')
            .description('A useful CLI in Node.js to use simple-data-crypto library')
            .version('1.0.0');

        // Encrypt command
        program
            .command('encrypt')
            .description('Encrypt file or data')
            .option('--password <password>', 'Specify password directly (NOT RECOMMENDED for security reasons because this exposes the password in the command line)')
            .option('--password-file <file>', 'Read password from specified file')
            .option('--password-script <script>', 'Execute script and read password from its stdout (similar to GIT_ASKPASS)')
            .option('-k, --skip-confirm', 'Skip password confirmation for encryption')
            .argument('[inputFile]', 'Input file path (empty for string encryption, "-" for stdin)')
            .argument('[outputFile]', 'Output file path (stdout if not specified)')
            .action(this.handleEncrypt.bind(this));

        // Decrypt command
        program
            .command('decrypt')
            .description('Decrypt file or data')
            .option('--password <password>', 'Specify password directly (NOT RECOMMENDED for security reasons)')
            .option('--password-file <file>', 'Read password from specified file')
            .option('--password-script <script>', 'Execute script and read password from its stdout (similar to GIT_ASKPASS)')
            .argument('[inputFile]', 'Input file path (empty for string decryption, "-" for stdin)')
            .argument('[outputFile]', 'Output file path (stdout if not specified)')
            .action(this.handleDecrypt.bind(this));

        // Change password command
        program
            .command('change-password')
            .description('Change password of encrypted file')
            .option('--password <password>', 'Specify current password directly (NOT RECOMMENDED)')
            .option('--password-file <file>', 'Read current password from specified file')
            .option('--password-script <script>', 'Execute script and read current password from its stdout')
            .option('--new-password <password>', 'Specify new password directly (NOT RECOMMENDED)')
            .option('--new-password-file <file>', 'Read new password from specified file')
            .option('--new-password-script <script>', 'Execute script and read new password from its stdout')
            .argument('<inputFile>', 'Input file path (cannot be empty, "-" for stdin)')
            .argument('[outputFile]', 'Output file path (in-place modification if not specified)')
            .action(this.handleChangePassword.bind(this));

        // Help command
        program
            .command('help')
            .description('Display help information')
            .action(() => {
                program.help();
            });
    }

    async getPassword(options, purpose = 'password') {
        // If password is provided via command line
        if (options.password) {
            //process.stderr.write(`Warning: Using password from command line is not secure\n`);
            return options.password;
        }

        // If password file is specified
        if (options.passwordFile) {
            try {
                const password = await fs.readFile(options.passwordFile, 'utf8');
                return password.trim();
            } catch (error) {
                throw new Error(`Failed to read password from file: ${error.message}`);
            }
        }

        // If password script is specified
        if (options.passwordScript) {
            return await new Promise((resolve, reject) => {
                const child = spawn(options.passwordScript, [purpose], { shell: false, stdio: ['inherit', 'pipe', 'inherit'] });
                let stdout = '';

                child.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                child.on('close', (code) => {
                    if (code === 0) {
                        resolve(stdout.trim());
                    } else {
                        reject(new Error(`Password script failed with code ${code}`));
                    }
                });
            });
        }

        // Interactive password input
        const questions = [
            {
                type: 'password',
                name: 'password',
                message: `Please enter ${purpose}:`,
                mask: '*'
            }
        ];

        const answers = await inquirer.prompt(questions);
        const password = answers.password;

        if (purpose === 'password' && !options.skipConfirm) {
            questions.splice(0, 1, {
                type: 'password',
                name: 'password',
                message: 'Please confirm password:',
                mask: '*',
            });
            const answers = await inquirer.prompt(questions);
            if (password !== answers.password) {
                console.log('❌ Password does not match');
                
                const retryAnswer = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'retry',
                        message: 'Would you like to try again?',
                        default: true
                    }
                ]);
                
                if (retryAnswer.retry) {
                    return this.getPassword(options, purpose);
                } else {
                    throw new Error('Password does not match');
                }
            }
        }
        
        return password;
    }
    
    async createFileReader(filePath) {
        if (filePath === '-') {
            const content = await this.readStdin();
            return (start, end) => {
                return Promise.resolve(new Uint8Array(content.buffer, start, end - start));
            };
        } else {
            const fileHandle = await fs.open(filePath, 'r');
            const fileSize = (await fileHandle.stat()).size;
            
            return async (start, end) => {
                const buffer = Buffer.alloc(end - start);
                const { bytesRead } = await fileHandle.read(buffer, 0, end - start, start);
                return new Uint8Array(buffer.buffer, 0, bytesRead);
            };
        }
    }
    
    async createFileWriter(filePath) {
        if (filePath === '-') {
            return (data) => {
                process.stdout.write(Buffer.from(data));
                return Promise.resolve();
            };
        } else {
            const fileHandle = await fs.open(filePath, 'w');
            return async (data) => {
                await fileHandle.write(Buffer.from(data));
            };
        }
    }
    
    readStdin() {
        return new Promise((resolve, reject) => {
            const chunks = [];
            process.stdin.on('data', (chunk) => {
                chunks.push(chunk);
            });
            process.stdin.on('end', async () => {
                resolve(Buffer.concat(chunks));
                //process.stderr.write('Warning: There is a known error that user will be unable to input password if the stdin is used. Try to specific password from options to temporarily mitigate the problem.\n')// fixed by spawning a child process to get password
            });
            process.stdin.on('error', reject);
        });
    }

    async handleEncrypt(inputFile, outputFile, options) {
        try {
            // Auto set skipConfirm if password is provided via non-interactive methods
            if (options.password || options.passwordFile || options.passwordScript) {
                options.skipConfirm = true;
            }

            if (!inputFile) {
                // String encryption
                const answers = await inquirer.prompt([
                    {
                        type: 'editor',
                        name: 'inputData',
                        message: 'Enter text to encrypt:',
                        description: 'Enter your text in the editor that will open. Save and close when done.',
                        waitUserInput: false
                    }
                ]);
                
                const password = await this.getPassword(options, 'password');
                const encrypted = await encrypt_data(answers.inputData, password);
                
                if (outputFile) {
                    await fs.writeFile(outputFile, encrypted);
                    process.stderr.write(`Encrypted string saved to: ${outputFile}\n`);
                } else {
                    process.stdout.write(encrypted);
                    process.stdout.write("\n"); // simple-data-crypto will auto trim the ciphertext
                }
            } else {
                // File encryption
                const fileReader = await this.createFileReader(inputFile);
                const fileWriter = await this.createFileWriter(outputFile || '-');
                if (inputFile === '-' && (!options.passwordScript)) options.passwordScript = fileURLToPath(import.meta.url) + '/../askpass.js';
                const password = await this.getPassword(options, 'password');

                const success = await encrypt_file(fileReader, fileWriter, password);
                
                if (success) {
                    if (outputFile) {
                        process.stderr.write(`File encrypted successfully: ${outputFile}\n`);
                    }
                } else {
                    throw new Error('File encryption failed');
                }
            }
        } catch (error) {
            process.stderr.write(`${error}\n`);
            process.exit(1);
        }
    }

    async handleDecrypt(inputFile, outputFile, options) {
        try {
            options.skipConfirm = true;
            if (!inputFile) {
                // String decryption
                const answers = await inquirer.prompt([
                    {
                        type: 'editor', 
                        name: 'inputData',
                        message: 'Enter encrypted text to decrypt:',
                        description: 'Enter your encrypted text in the editor that will open. Save and close when done.',
                        waitUserInput: false
                    }
                ]);
                const password = await this.getPassword(options, 'password');

                const decrypted = await decrypt_data(answers.inputData, password);
                
                if (outputFile) {
                    await fs.writeFile(outputFile, decrypted);
                    process.stderr.write(`Decrypted string saved to: ${outputFile}\n`);
                } else {
                    process.stdout.write(decrypted);
                }
            } else {
                // File decryption
                const fileReader = await this.createFileReader(inputFile);
                const fileWriter = await this.createFileWriter(outputFile || '-');
                if (inputFile === '-' && (!options.passwordScript)) options.passwordScript = fileURLToPath(import.meta.url) + '/../askpass.js';
                const password = await this.getPassword(options, 'password');
                
                const success = await decrypt_file(fileReader, fileWriter, password);
                
                if (success) {
                    if (outputFile) {
                        process.stderr.write(`File decrypted successfully: ${outputFile}\n`);
                    }
                } else {
                    throw new Error('File decryption failed');
                }
            }
        } catch (error) {
            process.stderr.write(`${error}\n`);
            process.exit(1);
        }
    }

    async handleChangePassword(inputFile, outputFile, options) {
        try {
            if (!inputFile) {
                throw new Error('Input file is required for change-password command');
            }

            // Get current password
            const currentPassword = await this.getPassword({
                password: options.password,
                passwordFile: options.passwordFile,
                passwordScript: options.passwordScript
            }, 'current password');

            // Get new password
            const newPassword = await this.getPassword({
                password: options.newPassword,
                passwordFile: options.newPasswordFile,
                passwordScript: options.newPasswordScript,
                skipConfirm: true
            }, 'new password');

            // Read file header (first 5KB as recommended)
            let fileBuffer;
            if (inputFile === '-') {
                fileBuffer = await this.readStdin();
            } else {
                fileBuffer = await fs.readFile(inputFile);
            }
            if (inputFile === '-' && (!options.passwordScript)) options.passwordScript = fileURLToPath(import.meta.url) + '/../askpass.js';

            // Take first 5KB or entire file if smaller
            const headerSize = Math.min(5 * 1024, fileBuffer.length);
            const fileHead = new Blob([fileBuffer.slice(0, headerSize)]);

            // Change password
            const newHeader = await change_file_password(fileHead, currentPassword, newPassword);

            // Convert Blob to Buffer for Node.js
            const newHeaderBuffer = Buffer.from(await newHeader.arrayBuffer());

            if (outputFile) {
                // Write to new file: new header + remaining file content
                const outputBuffer = Buffer.concat([
                    newHeaderBuffer,
                    fileBuffer.slice(newHeader.size)
                ]);
                await fs.writeFile(outputFile, outputBuffer);
                process.stderr.write(`New password has been applied to ${outputFile}\n`);
            } else if (inputFile !== '-') {
                // In-place modification
                const fileHandle = await fs.open(inputFile, 'r+');
                await fileHandle.write(newHeaderBuffer, 0, newHeaderBuffer.length, 0);
                await fileHandle.close();
                process.stderr.write(`Password has been changed successfully\n`);
            } else {
                // For stdin, output to stdout
                const outputBuffer = Buffer.concat([
                    newHeaderBuffer,
                    fileBuffer.slice(headerSize)
                ]);
                process.stdout.write(outputBuffer);
            }
        } catch (error) {
            process.stderr.write(`${error}\n`);
            process.exit(1);
        }
    }

    run() {
        program.parse();
    }
}

// Run the CLI
const cli = new CryptCLI();
cli.run();
