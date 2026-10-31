/** @type {import('next').NextConfig} */
const nextConfig = {
  // The embedding model and its native ONNX runtime must stay out of the webpack bundle.
  experimental: {
    serverComponentsExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
  },
  poweredByHeader: false,
};
export default nextConfig;
