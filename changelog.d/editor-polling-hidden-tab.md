- **Changed**: The editor stops its periodic refreshes (servers, PAPI placeholders, AI credits,
  updates, online players) while its tab is hidden, and refreshes once when it shows again. Through
  the Cloudflare tunnel every request costs a Durable Object request: a tab forgotten in the
  background made about 20,000 a day.
