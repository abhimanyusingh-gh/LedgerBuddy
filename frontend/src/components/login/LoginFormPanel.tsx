import { useState } from "react";

interface LoginFormPanelProps {
  email: string;
  password: string;
  submitting: boolean;
  error: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export function LoginFormPanel({
  email,
  password,
  submitting,
  error,
  onEmailChange,
  onPasswordChange,
  onSubmit
}: LoginFormPanelProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  return (
    <section className="login-form-panel">
      <div className="login-form-container">
        <div className="login-mobile-brand">
          <span className="material-symbols-outlined">analytics</span>
          <span>FinParse</span>
        </div>

        <header className="login-form-header">
          <h2>Welcome back</h2>
          <p>Please enter your details to access your FinParse account.</p>
        </header>

        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="login-input-group">
            <span>Email Address</span>
            <div className="login-input-shell">
              <span className="material-symbols-outlined login-input-icon">mail</span>
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="name@company.com"
                required
              />
            </div>
          </label>

          <label className="login-input-group">
            <div className="login-input-label-row">
              <span>Password</span>
              <button type="button" className="login-link-button">
                Forgot password?
              </button>
            </div>
            <div className="login-input-shell">
              <span className="material-symbols-outlined login-input-icon">lock</span>
              <input
                autoComplete="current-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((currentValue) => !currentValue)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <span className="material-symbols-outlined">{showPassword ? "visibility_off" : "visibility"}</span>
              </button>
            </div>
          </label>

          <label className="login-remember">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            <span>Remember me for 30 days</span>
          </label>

          <button type="submit" className="login-submit-button" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign In"}
          </button>

          {error ? <p className="error">{error}</p> : null}
        </form>

        <footer className="login-security">
          <div className="login-security-title">
            <span className="material-symbols-outlined">shield_lock</span>
            <p>Enterprise-Grade Security</p>
          </div>
          <p>Your data is protected by 256-bit AES encryption. FinParse is SOC2 Type II compliant and GDPR ready.</p>
        </footer>

        <nav className="login-foot-links" aria-label="Support links">
          <button type="button">Privacy Policy</button>
          <button type="button">Terms of Service</button>
          <button type="button">Contact Support</button>
        </nav>
      </div>
    </section>
  );
}
