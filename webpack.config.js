// webpack.config.js
const nodeExternals = require('webpack-node-externals');
const { RunScriptWebpackPlugin } = require('run-script-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');

module.exports = function (options, webpack) {
  return {
    ...options,
    entry: ['webpack/hot/poll?100', options.entry],
    externals: [
      nodeExternals({
        allowlist: ['webpack/hot/poll?100'],
      }),
    ],
    plugins: [
      // ① Copiamos promptVentas.json desde src/mcp a dist/mcp
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, 'src', 'mcp', 'promptVentas.json'),
            // 'to' relativo al output.path (por defecto dist/)
            to: 'mcp/promptVentas.json',
          },
        ],
      }),

      ...options.plugins,
      new webpack.HotModuleReplacementPlugin(),
      new webpack.WatchIgnorePlugin({
        paths: [/\.js$/, /\.d\.ts$/],
      }),
      new RunScriptWebpackPlugin({
        name: options.output.filename,
        autoRestart: false,
      }),
    ],
  };
};
