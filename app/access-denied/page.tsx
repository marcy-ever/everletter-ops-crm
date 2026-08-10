export const metadata = {
  title: "Access Denied — Everletter Ops CRM",
};

export default function AccessDeniedPage() {
  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div>
        <h1>Access Denied</h1>
        <p>Your Google account is signed in, but it isn&apos;t on the Everletter Ops CRM allowlist.</p>
        <p>Contact Marcy if you believe this is a mistake.</p>
        <p>
          <a href="/api/auth/signout">Sign out</a>
        </p>
      </div>
    </main>
  );
}
