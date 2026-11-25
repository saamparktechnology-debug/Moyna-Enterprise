//apps/web/src/features/auth/login-page.tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { LoginRequestSchema } from '@erp/contracts';
import type { LoginRequest } from '@erp/contracts';
import heroImage from '@/assets/login-hero.jpg';
import { Alert } from '@/components/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAuth } from './auth-provider';

function safeDestination(from: unknown): string {
  return typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    !from.startsWith('/login')
    ? from
    : '/';
}

/** The wheel-and-bolt mark. Colours come from the sign-in tokens in index.css. */
function BrandMark({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className} fill="none">
      <defs>
        <linearGradient
          id={gradientId}
          x1="8"
          y1="8"
          x2="58"
          y2="58"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" style={{ stopColor: 'var(--login-logo-from)' }} />
          <stop offset="1" style={{ stopColor: 'var(--login-logo-to)' }} />
        </linearGradient>
      </defs>
      <circle cx="38" cy="36" r="20" stroke={`url(#${gradientId})`} strokeWidth="5" />
      <circle cx="38" cy="36" r="4" fill={`url(#${gradientId})`} />
      <path
        d="M38 20v12M38 40v12M22 36h12M42 36h12M27 25l8 8M41 39l8 8M49 25l-8 8M35 39l-8 8"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M27 4 8 36h13l-5 24 21-34H24l3-22Z" fill={`url(#${gradientId})`} />
    </svg>
  );
}

interface FieldProps {
  label: string;
  error?: string | undefined;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => ReactElement;
}

function Field({ label, error, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-base font-medium text-(--login-heading)">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': error ? errorId : undefined,
      })}
      {error ? (
        <p id={errorId} aria-live="polite" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputClass = cn(
  'h-12 w-full rounded-xl border border-(--login-field-border) bg-card pl-11 pr-11 text-base text-foreground',
  'placeholder:text-muted-foreground outline-none transition-shadow',
  'focus:border-(--login-field-focus) focus:ring-4 focus:ring-(--login-field-focus)/20',
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
);

export function LoginPage() {
  const { user, expired, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { username: '', password: '' },
  });

  if (user && !isSubmitting) {
    return (
      <Navigate
        to={
          user.mustChangePassword
            ? '/change-password'
            : safeDestination((location.state as { from?: unknown } | null)?.from)
        }
        replace
      />
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const session = await signIn(values);
      navigate(
        session.user.mustChangePassword
          ? '/change-password'
          : safeDestination((location.state as { from?: unknown } | null)?.from),
        { replace: true },
      );
    } catch (error) {
      setServerError(
        error instanceof ApiError ? error.message : 'Something went wrong. Try again.',
      );
    }
  });

  return (
    <main className="grid min-h-screen bg-(--login-panel) lg:grid-cols-[62.5fr_37.5fr]">
      {/* Hero: shown from the large breakpoint up */}
      <aside className="relative hidden overflow-hidden bg-(--login-hero-bg) lg:block">
        <img
          src={heroImage}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 size-full object-cover object-center"
        />
        <div className="absolute left-[8.6%] top-[7.6%] flex items-center gap-5">
          <BrandMark className="size-[6.25rem] shrink-0" />
          <div>
            <p className="text-[2.5rem] font-bold uppercase leading-none text-(--login-hero-title)">
              Moyna Enterprise
            </p>
            <p className="mt-2 text-[1.35rem] leading-none text-(--login-hero-sub)">
              Multi-Branch Dealership ERP
            </p>
          </div>
        </div>
        <p className="absolute bottom-[4.2%] left-[8.3%] text-2xl text-(--login-hero-tagline)">
          E-Rickshaw Assembly · Batteries · Spare Parts
        </p>
      </aside>

      {/* Sign-in */}
      <section className="flex min-h-screen flex-col px-6 pb-14 pt-8 sm:px-12 lg:px-[4.25rem]">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-[23.75rem] -translate-y-5">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <BrandMark className="size-12 shrink-0" />
              <p className="text-xl font-extrabold uppercase tracking-tight text-(--login-heading)">
                Moyna Enterprise
              </p>
            </div>

            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-(--login-field-border) bg-(--login-badge) px-3.5 py-1.5 text-sm text-(--login-heading)">
              <span className="size-2 rounded-full bg-(--login-badge-dot)" aria-hidden="true" />
              Enterprise Portal
            </p>
            <h1 className="text-[2.75rem] font-extrabold leading-tight tracking-tight text-(--login-heading)">
              Welcome back
            </h1>
            <p className="mt-2 text-xl text-muted-foreground">Sign in to your workspace</p>

            <form onSubmit={onSubmit} noValidate className="mt-7 space-y-5">
              {expired ? <Alert>Your session ended. Sign in again to continue.</Alert> : null}
              {serverError ? <Alert tone="error">{serverError}</Alert> : null}

              <Field label="Username" error={errors.username?.message}>
                {(props) => (
                  <div className="relative">
                    <User
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      {...props}
                      type="text"
                      autoComplete="username"
                      autoFocus
                      className={inputClass}
                      {...register('username')}
                    />
                  </div>
                )}
              </Field>

              <Field label="Password" error={errors.password?.message}>
                {(props) => (
                  <div className="relative">
                    <Lock
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      {...props}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      className={inputClass}
                      {...register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((shown) => !shown)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {showPassword ? (
                        <EyeOff aria-hidden="true" className="size-5" />
                      ) : (
                        <Eye aria-hidden="true" className="size-5" />
                      )}
                    </button>
                  </div>
                )}
              </Field>

              <div className="-mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowHelp((shown) => !shown)}
                  aria-expanded={showHelp}
                  className="text-sm font-medium text-(--login-field-focus) hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Forgot password?
                </button>
              </div>
              {showHelp ? (
                <p className="rounded-lg bg-(--login-badge) px-3.5 py-2.5 text-sm text-(--login-heading)">
                  Ask your Admin to reset your password. They will give you a temporary one, and you
                  will choose a new password when you sign in.
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-12! w-full rounded-lg bg-(--login-button) text-base font-semibold text-primary-foreground shadow-sm hover:bg-(--login-button-hover)"
              >
                {isSubmitting ? (
                  'Signing in…'
                ) : (
                  <>
                    Sign in
                    <ArrowRight aria-hidden="true" className="size-5" />
                  </>
                )}
              </Button>
            </form>
          </div>
        </div>

        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="size-4" />
          Branch-scoped access · Encrypted session
        </p>
      </section>
    </main>
  );
}
