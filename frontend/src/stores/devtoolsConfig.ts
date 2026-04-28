export const devtoolsConfig = (name: string) => ({
  name,
  enabled: process.env.NODE_ENV !== "production"
});
