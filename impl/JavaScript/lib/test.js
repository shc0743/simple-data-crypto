import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { exec, spawn } from 'child_process';

if (process.argv.includes("help") || process.argv.includes("--help")) {
    console.log(`Usage: node test.js [options]`);
    console.log(`Options:`);
    console.log(`  --help, help: Show this help message`
    + `\n  no-browser-test: Skip browser test`
    + `\n  no-node-test: Skip node test`
    + `\n  no-module-exports-verification: Skip module exports verification`
    ); 
    process.exit(0);
}

const skip_tests = [];
if (process.argv.includes("no-browser-test")) {
    skip_tests.push("browser-test");
}
if (process.argv.includes("no-node-test")) {
    skip_tests.push("node-test"); 
}
if (process.argv.includes("no-module-exports-verification")) {
    skip_tests.push("module-exports-verification"); 
}

// module exports verification
console.log("--MODULE EXPORTS VERIFICATION--");
if (skip_tests.includes("module-exports-verification")) {
    console.log("[INFO] Skipped"); 
} else {
    console.log("Checking module exports...");
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['test/check-exports.js'], {
            stdio: 'inherit',
            cwd: process.cwd(),
        });
        child.on('close', (code) => {
            if (code !== 0) {
                console.error(`[ERROR] Module exports verification failed with code ${code}`);
                reject(new Error(`Module exports verification failed with code ${code}`));
            } else {
                console.log("[INFO] Module exports verification passed");
                resolve();
            }
        });
    });
}
console.log("");

// node test

import {
    ENCRYPTION_FILE_VER_1_1_0,
    ENCRYPTION_FILE_VER_1_2_10020,
    // Exceptions,
    InputStream,
    VERSION,
    change_file_password,
    crypt_context_create,
    crypt_context_destroy,
    decrypt_data,
    decrypt_file,
    decrypt_stream,
    decrypt_stream_init,
    derive_key,
    encrypt_data,
    encrypt_file,
    export_master_key,
    // get_random_bytes,
    // get_random_int8_number,
    // get_random_uint8_number,
    hexlify,
    is_encrypted_file,
    is_encrypted_message,
    // normalize_version,
    // scrypt,
    scrypt_hex,
    // str_decode,
    // str_encode,
    unhexlify,
} from './dist/main.bundle.node.js';

console.log("--NODE.JS TEST--");

if (skip_tests.includes("node-test")) {
    console.log("[INFO] Skipped");
} else {

    function unitLog(...args) {
        console.log('%cApp %cUnittest: ', 'color: green; font-weight: bold;', 'color: black', ...args);
    }

    function unitAssert(value) {
        if (!value) {
            console.error('%cApp %cUnittest Failed', 'color: green; font-weight: bold;', 'color: red');
            throw new Error('Assertion failed');
        }
        console.info('%cApp %cUnittest %cAssert OK', 'color: green; font-weight: bold;', 'color: black', 'color: green');
    }

    console.log("Version:", VERSION);
    console.log("File ver:", ENCRYPTION_FILE_VER_1_1_0, ";;", ENCRYPTION_FILE_VER_1_2_10020);

    console.log("Test data encryption");
    {
        const data = "123";
        const pass = "456;";
        const ciphertext = await encrypt_data(data, pass);
        console.log("ciphertext:", ciphertext);
        const plaintext = await decrypt_data(ciphertext, pass);
        console.log("plaintext:", plaintext);
        unitAssert(data === plaintext);

        console.log("Test IsEncryptedMessage");
        unitAssert((await is_encrypted_message(ciphertext)) === true);
        unitAssert((await is_encrypted_message(':this::is:a:messy:message::::')) === false);
    }

    console.log("Test file encryption");
    {
        const data = "Hello World!";
        const pass = "testpass123";

        // Create source data in memory
        const sourceData = Buffer.from(data);

        // Test encryption
        let encryptedBuffer = [];
        unitAssert(await encrypt_file(async (start, end) => {
            return new Uint8Array(sourceData.slice(start, end));
        }, (data) => {
            encryptedBuffer.push(data);
        }, pass));

        // Keep encrypted data in memory
        const encryptedData = Buffer.concat(encryptedBuffer);

        // Clear buffer
        encryptedBuffer.length = 0;
        unitAssert(encryptedBuffer.length === 0);

        // Test decryption
        let decryptedBuffer = [];
        unitAssert(await decrypt_file(async (start, end) => {
            return new Uint8Array(encryptedData.slice(start, end));
        }, (data) => {
            decryptedBuffer.push(data);
        }, pass));

        // Verify results
        const decryptedData = Buffer.concat(decryptedBuffer).toString();
        unitLog('decryptedData=', decryptedData);
        unitAssert(decryptedData === data);

        unitLog("test IsEncryptedFile");
        unitAssert(true === await is_encrypted_file(async (start, end) => {
            return new Uint8Array(encryptedData.slice(start, end));
        }));
        unitAssert(false === await is_encrypted_file(async (start, end) => {
            return new Uint8Array(10);
        }));

        unitLog("test export master key");
        const masterKey = await export_master_key(new Blob([encryptedData]), pass, 'export123');
        unitLog('masterKey=', masterKey);
        const raw_masterKey = await decrypt_data(masterKey, 'export123');
        unitLog('raw_masterKey=', raw_masterKey);
        unitAssert(typeof raw_masterKey === 'string');
    }

    unitLog('Test scrypt');
    const scN = 262144;
    const scr = 8;
    const scp = 1;
    const scdklen = 32;
    const scstr = 'lalala123';
    const scsalt = 'bebebe456';
    {
        // 测试相同的输入是否能得到相同的输出
        /*
    函数定义：
    export async function scrypt_hex(key, salt, N, r, p, dklen) {
        return hexlify(await scrypt(str_encode(key), str_encode(salt), N, r, p, dklen));
    }
        */
        const scValue1 = await scrypt_hex(scstr, scsalt, scN, scr, scp, scdklen);
        const scValue2 = await scrypt_hex(scstr, scsalt, scN, scr, scp, scdklen);
        unitLog('scValue1=', scValue1);
        unitLog('scValue2=', scValue2);
        unitAssert(scValue1 === scValue2);
    }

    unitLog('Test derive a key');
    {
        const key = 'mykeylalala123'
        const iv = new Uint8Array(await new Blob(['bebebe45609']).arrayBuffer());
        const phrase = 'Furina';
        const dk1 = await derive_key(key, iv, phrase, scN, new Uint8Array(await new Blob([scsalt, 'exex']).arrayBuffer()), scr, scp, scdklen);
        unitLog('dk1=', dk1);
        const dk2 = await derive_key(key, iv, phrase, scN, new Uint8Array(await new Blob([scsalt, 'exex']).arrayBuffer()), scr, scp, scdklen);
        unitLog('dk2=', dk2);
        unitAssert(hexlify(dk1.derived_key) === hexlify(dk2.derived_key));

        const dk3 = await derive_key(key, iv);
        unitLog('dk3(random)=', dk3);
    }

    unitLog('Test context');
    {
        const ctx = await crypt_context_create();
        unitLog('ctx=', ctx);
        unitAssert(ctx);
        await crypt_context_destroy(ctx);
        unitLog('ctx destroyed');
        unitAssert(ctx._released);
    }

    unitLog("test binascii")
    {
        const hex = '313233'
        unitAssert(hexlify(unhexlify(hex)) === hex)
        const str = new Uint8Array(await new Blob(['456789']).arrayBuffer())
        unitAssert((hexlify(str)) === '343536373839');
    }
}

console.log("--NODE.JS TEST END--\n\nBrowser test:\n");
// web test

if (skip_tests.includes("browser-test")) {
    console.log("[INFO] Skipped");
} else {

    let ttid = 0;

    const server = http.createServer((req, res) => {
        const requestPath = url.parse(req.url).pathname;
        const filePath = path.join(process.cwd(), requestPath);

        try {
            // 如果请求/server-stop，则停止服务器
            if (requestPath === '/server-stop') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Server is stopping...' + (req.method === 'PUT' ? " (Bad)" : ""));
                if (process.argv[2] === 'debug') {
                    console.warn('Warning:Debug mode on. Server will not stop unless Press Ctrl-C.');
                } else {
                    server.close(() => {
                        if (req.method === 'PUT') {
                            console.error("Test failed!!");
                            console.error('Error:');
                            console.error(req.read()?.toString() || '');
                            process.exit(1);
                        }
                        else console.log('Test completed.');
                    });
                    server.closeAllConnections();
                }
                clearTimeout(ttid);
                return;
            }

            const stat = fs.statSync(filePath);
        
            if (stat.isDirectory()) {
                const indexPath = path.join(filePath, 'index.html');
                if (fs.existsSync(indexPath)) {
                    fs.createReadStream(indexPath).pipe(res);
                } else {
                    const files = fs.readdirSync(filePath);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`<pre>${files.join('\n')}</pre>`);
                }
            } else {
                const ext = path.extname(filePath);
                const contentType = {
                    '.html': 'text/html',
                    '.js': 'text/javascript',
                    '.css': 'text/css',
                    '.json': 'application/json',
                }[ext] || 'application/octet-stream';
            
                res.writeHead(200, { 'Content-Type': contentType });
                fs.createReadStream(filePath).pipe(res);
            }
        } catch (err) {
            res.writeHead(404);
            res.end('404 Not Found');
        }
    })



    server.listen(36429, '127.0.0.1', () => {
        console.log("Test is running in your browser now. URL: http://127.0.0.1:36429/test/test-app.html");
        // 启动浏览器
        const platform = process.platform;
        const cmd = platform === 'win32' ? 'start' : platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${cmd} http://127.0.0.1:36429/test/test-app.html`);

        ttid = setTimeout(() => {
            server.close(() => {
                console.error('Test timed out.');
            });
            server.closeAllConnections();
        }, 60000);
    });


}

