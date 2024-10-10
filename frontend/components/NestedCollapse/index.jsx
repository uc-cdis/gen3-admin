import React, { useState } from 'react';
import {
  Button,
  Collapse,
  Text,
  TextInput,
  NumberInput,
  Switch,
  Group,
  Tooltip,
  ActionIcon,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';

function NestedCollapses({ data, path = [], onChange }) {
  const [opened, setOpened] = useState({});
  const [editing, setEditing] = useState({});
  const [newKey, setNewKey] = useState(''); // For adding new keys to objects
  const [localData, setLocalData] = useState(data);

  const handleToggle = (key) => {
    setOpened((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleEditToggle = (key) => {
    setEditing((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleValueChange = (key, value) => {
    const newData = { ...localData, [key]: value };
    setLocalData(newData);
    if (onChange) {
      onChange(path.concat(key), value);
    }
  };

  const handleAddKeyValue = () => {
    if (newKey.trim() === '') return; // Do not allow empty keys
    const newData = { ...localData, [newKey]: '' }; // Default value is an empty string
    setLocalData(newData);
    setNewKey('');
    if (onChange) {
      onChange(path.concat(newKey), ''); // Notify parent of the new key-value pair
    }
  };

  const handleDeleteKey = (key) => {
    const { [key]: _, ...rest } = localData;
    setLocalData(rest);
    if (onChange) {
      onChange(path.concat(key), undefined); // Notify parent of the deletion
    }
  };

  const handleAddArrayItem = () => {
    const newData = [...localData, '']; // Add an empty string as a new item
    setLocalData(newData);
    if (onChange) {
      onChange(path, newData); // Notify parent of the new array item
    }
  };

  const handleDeleteArrayItem = (index) => {
    const newData = localData.filter((_, i) => i !== index);
    setLocalData(newData);
    if (onChange) {
      onChange(path, newData); // Notify parent of the deletion
    }
  };

  if (typeof localData === 'object' && localData !== null) {
    // Handle Array Rendering
    if (Array.isArray(localData)) {
      return (
        <div style={{ paddingLeft: '20px', marginTop: '10px' }}>
          {localData.map((item, index) => (
            <div key={index} style={{ marginLeft: '10px', marginTop: '10px', position: 'relative' }}>
              <Group position="apart">
                <NestedCollapses
                  data={item}
                  path={path.concat(index)}
                  onChange={onChange}
                />
                {/* Show delete button on hover only */}
                <ActionIcon
                  color="gray"
                  onClick={() => handleDeleteArrayItem(index)}
                  style={{ visibility: 'hidden', position: 'absolute', right: 0, top: 0 }}
                  className="show-on-hover"
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            </div>
          ))}
          <Button
            leftIcon={<IconPlus size={16} />}
            variant="subtle"
            onClick={handleAddArrayItem}
            style={{ marginTop: '10px' }}
          >
            Add Item
          </Button>
        </div>
      );
    } else {
      // Handle Object Rendering
      return (
        <div>
          {Object.entries(localData).map(([key, value], index) => (
            <div
              key={index}
              style={{
                marginTop: '10px',
                paddingLeft: '10px',
                padding: '5px',
                borderRadius: '4px',
                backgroundColor: opened[key] ? '#f8f9fa' : 'transparent',
                position: 'relative',
              }}
            >
              {typeof value === 'object' && value !== null ? (
                // Collapsible section for nested objects/arrays
                <div style={{ marginBottom: '10px' }}>
                  <Group>
                    <Button
                      variant="subtle"
                      onClick={() => handleToggle(key)}
                      style={{
                        paddingLeft: 0,
                        color: '#1c7ed6',
                        fontWeight: 'bold',
                        fontSize: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      {opened[key] ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                      {key}
                    </Button>
                    {/* Show delete button only on hover */}
                    <ActionIcon
                      color="gray"
                      onClick={() => handleDeleteKey(key)}
                      style={{ visibility: 'hidden' }}
                      className="show-on-hover"
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                  <Collapse in={opened[key]}>
                    <div style={{ paddingLeft: '15px', paddingTop: '5px', borderLeft: '1px solid #dee2e6' }}>
                      <NestedCollapses
                        data={value}
                        path={path.concat(key)}
                        onChange={onChange}
                      />
                    </div>
                  </Collapse>
                </div>
              ) : (
                // Inline key-value for non-object primitives with hover/editable indicators
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '10px',
                    cursor: editing[key] ? 'default' : 'pointer',
                    padding: '2px 0',
                  }}
                >
                  <Text style={{ fontWeight: 'bold', marginRight: '5px', fontSize: '14px' }}>
                    {key}:
                  </Text>
                  {typeof value === 'boolean' ? (
                    <Switch
                      checked={value}
                      onChange={(event) =>
                        handleValueChange(key, event.currentTarget.checked)
                      }
                    />
                  ) : editing[key] ? (
                    typeof value === 'number' ? (
                      <NumberInput
                        value={value}
                        onChange={(value) => handleValueChange(key, value)}
                        onBlur={() => handleEditToggle(key)}
                        style={{ width: '100px' }}
                        autoFocus
                      />
                    ) : (
                      <TextInput
                        value={value}
                        onChange={(event) =>
                          handleValueChange(key, event.currentTarget.value)
                        }
                        onBlur={() => handleEditToggle(key)}
                        style={{ width: '200px' }}
                        autoFocus
                      />
                    )
                  ) : (
                    <Group spacing={2}>
                      <Text
                        style={{ color: '#495057' }}
                        onClick={() => handleEditToggle(key)}
                      >
                        {String(value)}
                      </Text>
                      <Tooltip label="Edit" withArrow>
                        <IconPencil size={14} style={{ color: '#1c7ed6' }} />
                      </Tooltip>
                    </Group>
                  )}
                  {/* Show delete button only on hover */}
                  <ActionIcon
                    color="gray"
                    onClick={() => handleDeleteKey(key)}
                    style={{ visibility: 'hidden' }}
                    className="show-on-hover"
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </div>
              )}
            </div>
          ))}
          {/* Add New Key-Value Input */}
          <Group spacing={5} style={{ marginTop: '10px' }}>
            <TextInput
              value={newKey}
              placeholder="New Key"
              onChange={(event) => setNewKey(event.currentTarget.value)}
              style={{ width: '200px' }}
            />
            <Button
              leftIcon={<IconPlus size={16} />}
              variant="subtle"
              onClick={handleAddKeyValue}
            >
              Add Key
            </Button>
          </Group>
        </div>
      );
    }
  } else {
    return null;
  }
}

export default NestedCollapses;
