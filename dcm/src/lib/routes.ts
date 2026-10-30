export const COMPOSE = "/compose"
export const APPS = "/apps"

export const routes = {
  apps: APPS,
  app: (id: string) => `${APPS}/${id}`,
  compose: COMPOSE,
  templates: `${COMPOSE}/templates`,
  suggest: `${COMPOSE}/suggest`,
  template: (id: string) => `${COMPOSE}/template/${id}`,
}
