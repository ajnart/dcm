package homarr

// REST creation accepts size; existing items instead carry one placement per
// responsive layout. Resize only this item and move it if it would overlap.
func resizeItem(current, item map[string]any, items []map[string]any, width, height int, grow bool) {
	if size, ok := item["size"].(map[string]any); ok {
		w, h := width, height
		if grow {
			w = max(w, gridNumber(size, "width"))
			h = max(h, gridNumber(size, "height"))
		}
		item["size"] = map[string]any{"width": w, "height": h}
	}
	layouts, _ := item["layouts"].([]any)
	for _, raw := range layouts {
		placement, _ := raw.(map[string]any)
		if placement == nil {
			continue
		}
		columns := placementColumns(current, placement)
		w, h := width, height
		if grow {
			w = max(w, gridNumber(placement, "width"))
			h = max(h, gridNumber(placement, "height"))
		}
		if columns > 0 && w > columns {
			w = columns
		}
		placement["width"], placement["height"] = w, h
		if columns > 0 && gridNumber(placement, "xOffset")+w > columns {
			placement["xOffset"] = 0
		}
		bottom := 0
		collision := false
		neighbors := append([]map[string]any{}, items...)
		sections, _ := current["sections"].([]any)
		for _, raw := range sections {
			if section, ok := raw.(map[string]any); ok {
				neighbors = append(neighbors, section)
			}
		}
		for _, neighbor := range neighbors {
			if stringField(neighbor, "id") == stringField(item, "id") {
				continue
			}
			placements, _ := neighbor["layouts"].([]any)
			for _, raw := range placements {
				other, _ := raw.(map[string]any)
				sectionID := stringField(other, "sectionId")
				if stringField(neighbor, "kind") == "container" {
					sectionID = stringField(other, "parentSectionId")
				}
				if stringField(other, "layoutId") != stringField(placement, "layoutId") || sectionID != stringField(placement, "sectionId") {
					continue
				}
				end := gridNumber(other, "yOffset") + gridNumber(other, "height")
				if end > bottom {
					bottom = end
				}
				if placementsOverlap(placement, other) {
					collision = true
				}
			}
		}
		if collision {
			placement["yOffset"] = bottom
		}
	}
}

func placementColumns(current, placement map[string]any) int {
	sections, _ := current["sections"].([]any)
	for _, raw := range sections {
		section, _ := raw.(map[string]any)
		if stringField(section, "id") != stringField(placement, "sectionId") || stringField(section, "kind") != "container" {
			continue
		}
		layouts, _ := section["layouts"].([]any)
		for _, raw := range layouts {
			layout, _ := raw.(map[string]any)
			if stringField(layout, "layoutId") == stringField(placement, "layoutId") {
				return gridNumber(layout, "width")
			}
		}
	}
	layouts, _ := current["layouts"].([]any)
	for _, raw := range layouts {
		layout, _ := raw.(map[string]any)
		if stringField(layout, "id") == stringField(placement, "layoutId") {
			for _, raw := range sections {
				section, _ := raw.(map[string]any)
				if stringField(section, "id") == stringField(placement, "sectionId") {
					switch gridNumber(section, "xOffset") {
					case -1:
						return gridNumber(layout, "leftGutterColumnCount")
					case 1:
						return gridNumber(layout, "rightGutterColumnCount")
					}
				}
			}
			return gridNumber(layout, "columnCount") - gridNumber(layout, "leftGutterColumnCount") - gridNumber(layout, "rightGutterColumnCount")
		}
	}
	return 0
}

func placementsOverlap(a, b map[string]any) bool {
	return gridNumber(a, "xOffset") < gridNumber(b, "xOffset")+gridNumber(b, "width") &&
		gridNumber(b, "xOffset") < gridNumber(a, "xOffset")+gridNumber(a, "width") &&
		gridNumber(a, "yOffset") < gridNumber(b, "yOffset")+gridNumber(b, "height") &&
		gridNumber(b, "yOffset") < gridNumber(a, "yOffset")+gridNumber(a, "height")
}

func gridNumber(record map[string]any, key string) int {
	switch value := record[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	default:
		return 0
	}
}

func itemSizeMatches(current, item map[string]any, width, height int) bool {
	if size, ok := item["size"].(map[string]any); ok {
		return gridNumber(size, "width") == width && gridNumber(size, "height") == height
	}
	layouts, _ := item["layouts"].([]any)
	for _, raw := range layouts {
		layout, _ := raw.(map[string]any)
		w := width
		if columns := placementColumns(current, layout); columns > 0 && w > columns {
			w = columns
		}
		if gridNumber(layout, "width") != w || gridNumber(layout, "height") != height {
			return false
		}
	}
	return true
}
