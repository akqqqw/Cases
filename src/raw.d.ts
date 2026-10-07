/** Vite hands over file contents as text for `?raw` imports. */
declare module '*?raw' {
  const content: string;
  export default content;
}
