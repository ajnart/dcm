export const COMPOSE = "/compose"

export const routes = {
  compose: COMPOSE,
  templates: `${COMPOSE}/templates`,
  template: (id: string) => `${COMPOSE}/template/${id}`,
}
