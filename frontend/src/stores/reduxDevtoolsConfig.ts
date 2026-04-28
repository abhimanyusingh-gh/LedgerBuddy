export const reduxDevtoolsConfig = (name: string) => ({
  name,
  enabled: process.env.NODE_ENV !== "production"
});
