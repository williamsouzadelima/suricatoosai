import { getAuthErrorInfo } from "./auth-error-info";
import { AuthErrorCard } from "./AuthErrorCard";

type SearchParams = Promise<{ code?: string }>;

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { code } = await searchParams;
  const { key, autoRetry } = getAuthErrorInfo(code);

  return (
    <AuthErrorCard errorKey={key} code={code ?? null} autoRetry={autoRetry} />
  );
}
