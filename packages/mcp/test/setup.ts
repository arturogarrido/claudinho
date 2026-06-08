// Keep unit tests hermetic. In production the Polymarket adapter derives an
// event slug per fixture and fetches the live API; in tests we route the
// *default* market provider to a network-free no-op so tool tests never touch
// the network. Tests that exercise market behavior inject their own provider.
process.env.CLAUDINHO_MARKETS_SOURCE = 'none';
