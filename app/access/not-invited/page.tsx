import { Lock, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Acesso por convite",
};

export default function NotInvitedPage() {
  const supportEmail =
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "contato@suricatoos.com";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl">Acesso por convite</CardTitle>
          <CardDescription className="mt-2">
            O acesso a esta plataforma é apenas por convite. A conta usada não
            está autorizada no momento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-center text-sm text-muted-foreground">
            Se você acredita que deveria ter acesso, solicite um convite em{" "}
            <a
              href={`mailto:${supportEmail}`}
              className="underline underline-offset-4"
            >
              {supportEmail}
            </a>
            .
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row w-full">
          <Button asChild variant="outline" className="flex-1 min-w-0">
            <a href="/login">
              <LogIn className="h-4 w-4" />
              Entrar com outra conta
            </a>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
