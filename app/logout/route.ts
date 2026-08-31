import { signOut } from "@workos-inc/authkit-nextjs";

// Base pública explícita: atrás do proxy o Next não infere o host, e sem
// "App Homepage URL" no WorkOS o signOut() sem returnTo falha (app-homepage-url-not-found).
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://ai.suricatoos.com";

export const GET = async () => {
  return signOut({ returnTo: APP_BASE_URL });
};
