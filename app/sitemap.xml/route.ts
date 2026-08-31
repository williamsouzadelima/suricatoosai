const SITEMAP_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://ai.suricatoos.com/</loc></url>
  <url><loc>https://ai.suricatoos.com/download</loc></url>
  <url><loc>https://ai.suricatoos.com/trust</loc></url>
  <url><loc>https://ai.suricatoos.com/privacy-policy</loc></url>
  <url><loc>https://ai.suricatoos.com/terms-of-service</loc></url>
</urlset>
`;

export const dynamic = "force-static";

export function GET() {
  return new Response(SITEMAP_CONTENT, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
