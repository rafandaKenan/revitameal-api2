export default async function handler(req, res) {
  console.log("=== DOKU SENT ===");
  console.log(req.headers);
  console.log(await req.body);
  res.status(200).json({ received: true });
}
