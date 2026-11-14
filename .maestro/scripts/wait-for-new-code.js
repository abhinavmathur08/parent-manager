// Waits out the 30-second gap Supabase Auth keeps between codes to one address
// (supabase/config.toml), so the flow can ask for a second code.
var until = Date.now() + 31000;
while (Date.now() < until) {
  // Maestro's script sandbox has no timers, so this waits by spinning.
}
