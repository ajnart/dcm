package catalog

import "github.com/ajnart/self-host/internal/app"

// ported holds the Apps that porting batches register from their own
// batch_<name>.go file (func init() { register(...) }), so parallel ports
// never edit the same line. Files init in name order, so the order is stable.
var ported []app.App

func register(apps ...app.App) { ported = append(ported, apps...) }

// portedRecipes is the same for Recipes.
var portedRecipes []Recipe

func registerRecipes(recipes ...Recipe) { portedRecipes = append(portedRecipes, recipes...) }
