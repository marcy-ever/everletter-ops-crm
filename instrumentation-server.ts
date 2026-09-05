const FIVE_MINUTES = 5 * 60 * 1000;

async function checkSquarespace(): Promise<void> {
  if (!process.env.SQUARESPACE_API_KEY || !process.env.DATABASE_URL) return;
  try {
    const { POST } = await import("./app/api/squarespace-sync/route");
    const response = await POST();
    if (!response.ok) console.error("Scheduled Squarespace check failed", response.status);
  } catch (error) {
    console.error("Scheduled Squarespace check failed", error);
  }
}

const firstCheck = setTimeout(checkSquarespace, 30_000);
const repeatedChecks = setInterval(checkSquarespace, FIVE_MINUTES);
firstCheck.unref();
repeatedChecks.unref();

export {};
