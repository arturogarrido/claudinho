// Keep unit tests hermetic. In production the Polymarket adapter derives an
// event slug per fixture and fetches the live API; in tests we route the
// *default* market provider to a network-free no-op so command tests never
// touch the network. Tests that exercise market behavior inject their own
// provider (which takes precedence over this env).
process.env.CLAUDINHO_MARKETS_SOURCE = 'none';
