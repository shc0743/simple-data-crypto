import { createHash } from 'crypto';
import { createReadStream, statSync } from 'fs';

export function sha256File(filename, onProgress = null) {
  return new Promise((resolve, reject) => {
    let fileSize;
    try {
      const stats = statSync(filename);
      fileSize = stats.size;
    } catch (error) {
      reject(error);
      return;
    }
    
    let totalBytesRead = 0;
    const hash = createHash('sha256');
    const stream = createReadStream(filename);
    
    stream.on('data', (chunk) => {
      hash.update(chunk);
      totalBytesRead += chunk.length;
      
      if (onProgress && typeof onProgress === 'function') {
        const progress = fileSize > 0 ? totalBytesRead / fileSize : 0;
        onProgress(progress, totalBytesRead, fileSize);
      }
    });
    
    stream.on('end', () => {
      if (onProgress && typeof onProgress === 'function') {
        onProgress(1, fileSize, fileSize);
      }
      resolve(hash.digest('hex'));
    });
    
    stream.on('error', (error) => {
      reject(error);
    });
  });
}

