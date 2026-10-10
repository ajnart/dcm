package system

import "runtime"

type CapturedPanic struct {
	Value any
	Stack []uintptr
}

func CatchPanic(run func()) (crash *CapturedPanic) {
	defer func() {
		if value := recover(); value != nil {
			if captured, ok := value.(CapturedPanic); ok {
				crash = &captured
				return
			}
			pcs := make([]uintptr, 64)
			crash = &CapturedPanic{Value: value, Stack: pcs[:runtime.Callers(2, pcs)]}
		}
	}()
	run()
	return nil
}
