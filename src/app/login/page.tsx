import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-app flex items-center justify-center p-4">
      <Suspense fallback={<div className="w-full max-w-md"><div className="animate-pulse h-96 bg-muted rounded-xl" /></div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}