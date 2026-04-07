
/**
 * BITRUVIAN IMAGE PROCESSOR
 * Handles background elimination, auto-cropping, and texture prep.
 */

export const processTextureImage = (file: File, eliminateBackground: boolean = true): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject('No context');

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let data = imageData.data;

        let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
        let foundAny = false;

        if (eliminateBackground) {
          // Sample background color from top-left pixel
          const bgR = data[0];
          const bgG = data[1];
          const bgB = data[2];

          // Sensitivity parameters
          const colorThreshold = 45; 
          const darkLuminanceThreshold = 80; 

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            const distance = Math.sqrt(
              Math.pow(r - bgR, 2) + 
              Math.pow(g - bgG, 2) + 
              Math.pow(b - bgB, 2)
            );

            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

            if (distance < colorThreshold && luminance > darkLuminanceThreshold) {
              data[i + 3] = 0; // Alpha
            } else {
              // Bounding box calculation for crop
              const x = (i / 4) % canvas.width;
              const y = Math.floor((i / 4) / canvas.width);
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
              foundAny = true;
            }
          }
        } else {
          foundAny = true;
          minX = 0; minY = 0; maxX = canvas.width - 1; maxY = canvas.height - 1;
        }

        if (!foundAny) {
          resolve(canvas.toDataURL('image/png'));
          return;
        }

        // Auto-crop to bounding box
        const cropW = (maxX - minX) + 1;
        const cropH = (maxY - minY) + 1;
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext('2d');
        
        if (cropCtx) {
          // Temporarily put data back to source canvas to use drawImage for cropping
          ctx.putImageData(imageData, 0, 0);
          cropCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
          resolve(cropCanvas.toDataURL('image/png'));
        } else {
          resolve(canvas.toDataURL('image/png'));
        }
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};
