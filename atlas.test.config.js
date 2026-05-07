// atlas.test.config.js
// Resolution overrides for scripts/atlas_runtime_test.js

module.exports = {
  testSymbol: 'EURUSD',

  engines: {
    spidey:     { module: './spidey',      function: 'spideyRun' },
    corey:      { module: './corey',       function: 'coreyRun' },
    coreyClone: { module: './corey_clone', function: 'coreyCloneRun' },
    macro:      { module: './macro',       function: 'macroRun' },
    jane:       { module: './jane',        function: 'runJane' },
  },

  output: {
    discord:   { module: './discord_output',    function: 'deliverToDiscord' },
    dashboard: { module: './dashboard_session', function: 'publishToDashboard' },
  },
};
