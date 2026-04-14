import { LoginBrandPanel } from "@/features/auth/LoginBrandPanel";
import { LoginFormPanel } from "@/features/auth/LoginFormPanel";

interface LoginPageProps {
  email: string;
  password: string;
  submitting: boolean;
  error: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export function LoginPage({
  email,
  password,
  submitting,
  error,
  onEmailChange,
  onPasswordChange,
  onSubmit
}: LoginPageProps) {
  return (
    <div className="login-page-shell">
      <LoginBrandPanel />
      <LoginFormPanel
        email={email}
        password={password}
        submitting={submitting}
        error={error}
        onEmailChange={onEmailChange}
        onPasswordChange={onPasswordChange}
        onSubmit={onSubmit}
      />
    </div>
  );
}
