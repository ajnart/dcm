package systemtest

import (
	"os"
	"sync"
)

type ConfigFiles struct {
	mu    sync.Mutex
	files map[string][]byte
	Error error
}

func (c *ConfigFiles) LoadOrCreateConfigFile(name string, create func() ([]byte, error)) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Error != nil {
		return nil, c.Error
	}
	if data, ok := c.files[name]; ok {
		return append([]byte(nil), data...), nil
	}
	data, err := create()
	if err != nil {
		return nil, err
	}
	if c.files == nil {
		c.files = map[string][]byte{}
	}
	c.files[name] = append([]byte(nil), data...)
	return append([]byte(nil), data...), nil
}

func (c *ConfigFiles) ReadConfigFile(name string) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, ok := c.files[name]
	if !ok {
		return nil, os.ErrNotExist
	}
	return append([]byte(nil), data...), nil
}

func (c *ConfigFiles) WriteConfigFile(name string, data []byte, _ os.FileMode) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.files == nil {
		c.files = map[string][]byte{}
	}
	c.files[name] = append([]byte(nil), data...)
	return nil
}

func (c *ConfigFiles) Remove(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.files, name)
}
