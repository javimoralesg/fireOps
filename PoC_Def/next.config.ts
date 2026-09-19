import type { NextConfig } from "next";

// DUEÑO: constructor A. Ver docs/DESPLIEGUE.md.
const nextConfig: NextConfig = {
  // Paquetes con binarios nativos: no los empaqueta el bundler, se cargan con
  // el require de Node. transformers.js/onnxruntime los usa C (embeddings en
  // proceso) y sharp el tratamiento de imágenes de las cámaras.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],

  // En `next dev`, permite abrir la app desde el móvil vía túnel de Cloudflare
  // (HTTPS, necesario para la cámara). Sin esto Next rechaza el HMR y los
  // recursos de desarrollo pedidos desde ese origen.
  allowedDevOrigins: ["*.trycloudflare.com"],

  // output: "standalone" NO se activa a propósito: en Railway arrancamos con
  // `npm run start` (= next start), que necesita el build completo. El modo
  // standalone obligaría a cambiar el comando a `node .next/standalone/server.js`
  // y a copiar a mano `public/` y `.next/static/`. Ver docs/DESPLIEGUE.md.
};

export default nextConfig;
