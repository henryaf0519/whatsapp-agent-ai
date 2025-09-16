// webpack.config.js
// --- COPIA Y PEGA ESTE CÓDIGO COMPLETO ---

const { RunScriptWebpackPlugin } = require('run-script-webpack-plugin');
const nodeExternals = require('webpack-node-externals');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

module.exports = function (options, webpack) {
  const isWatchMode = options.watch;

  return {
    ...options,
    entry: ['webpack/hot/poll?100', options.entry],
    externals: [
      nodeExternals({
        allowlist: ['webpack/hot/poll?100'],
      }),
    ],
    plugins: [
      ...options.plugins,
      new webpack.HotModuleReplacementPlugin(),
      new webpack.WatchIgnorePlugin({
        paths: [/\.js$/, /\.d\.ts$/],
      }),
      new RunScriptWebpackPlugin({
        name: options.output.filename,
        autoRestart: false,
      }),

      // Si NO estamos en modo "watch", se ejecuta la revisión de tipos.
      // Si SÍ estamos en modo "watch" (npm run start:dev), se desactiva para ahorrar RAM.
      !isWatchMode && new ForkTsCheckerWebpackPlugin(),
    ].filter(Boolean), // Elimina plugins desactivados (como el de arriba en modo watch)
  };
};