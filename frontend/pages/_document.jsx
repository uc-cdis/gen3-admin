import Document, { Head, Html, Main, NextScript } from 'next/document';
import { ColorSchemeScript } from '@mantine/core';

/**
 * ColorSchemeScript must run before first paint: it applies the stored color
 * scheme to <html> so the page does not flash the wrong theme, and so
 * `useMantineColorScheme` agrees with what is actually rendered. Without it the
 * light/dark toggle appears to do nothing on reload.
 */
export default class _Document extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <ColorSchemeScript defaultColorScheme="auto" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
