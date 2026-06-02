import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
      <div className="text-center space-y-4">
        <div className="text-7xl font-black text-primary">404</div>
        <h1 className="text-2xl font-bold">Page Not Found</h1>
        <p className="text-muted-foreground text-sm">This page doesn't exist.</p>
        <Link href="/" className="inline-block mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity">
          Go Home
        </Link>
      </div>
    </div>
  );
}
