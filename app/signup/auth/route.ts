import { getSignInUrl, getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { redirectToAuthorizationUrl } from "@/lib/auth/auth-redirect-intents";
import { isInviteOnlyEnabled } from "@/lib/auth/invite-access";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Invite-only: no public self-registration. Send would-be sign-ups to the
  // sign-in screen instead. Invited users create their account through the
  // WorkOS invitation email link, not this route.
  const authorizationUrl = isInviteOnlyEnabled()
    ? await getSignInUrl()
    : await getSignUpUrl();
  return redirectToAuthorizationUrl(authorizationUrl, url);
}
