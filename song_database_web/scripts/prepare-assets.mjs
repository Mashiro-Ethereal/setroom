import {mkdir,copyFile} from 'node:fs/promises';
await mkdir(new URL('../static/vendor/',import.meta.url),{recursive:true});
await copyFile(new URL('../node_modules/fflate/esm/browser.js',import.meta.url),new URL('../static/vendor/fflate.js',import.meta.url));
await copyFile(new URL('../node_modules/fflate/LICENSE',import.meta.url),new URL('../static/vendor/fflate.LICENSE',import.meta.url));
