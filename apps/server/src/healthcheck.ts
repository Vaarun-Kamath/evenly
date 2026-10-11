// Docker HEALTHCHECK entry point: asks the running server for /healthz at its own base path.
import { deriveBasePath } from "./basePath";

function setting(value: string | undefined, fallback: string): string {
  return value === undefined || value === "" ? fallback : value;
}

const port = setting(process.env.PORT, "3000");
const publicUrl = setting(process.env.PUBLIC_URL, "http://localhost:3000");

try {
  const basePath = deriveBasePath(publicUrl, process.env.BASE_PATH);
  const response = await fetch(`http://127.0.0.1:${port}${basePath}/healthz`, {
    signal: AbortSignal.timeout(4000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
