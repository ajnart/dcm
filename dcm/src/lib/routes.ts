export const COMPOSE = "/compose"

export const routes = {
  compose: COMPOSE,
  templates: `${COMPOSE}/templates`,
  suggest: `${COMPOSE}/suggest`,
  template: (id: string) => `${COMPOSE}/template/${id}`,
}
