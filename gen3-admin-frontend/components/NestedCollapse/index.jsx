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
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconPencil } from '@tabler/icons-react';

function NestedCollapses({ data, path = [], onChange }) {
  const [opened, setOpened] = useState({});
  const [editing, setEditing] = useState({});
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

  if (typeof localData === 'object' && localData !== null) {
    // Handle Array Rendering
    if (Array.isArray(localData)) {
      return (
        <div style={{ paddingLeft: '20px', marginTop: '10px' }}>
          {localData.map((item, index) => (
            <div key={index} style={{ marginLeft: '10px', marginTop: '10px' }}>
              <NestedCollapses
                data={item}
                path={path.concat(index)}
                onChange={onChange}
              />
            </div>
          ))}
        </div>
      );
    } else {
      // Handle Object Rendering
      return (
        <div>
          {Object.entries(localData).map(([key, value], index) => (
            <div key={index} style={{ marginTop: '10px', paddingLeft: '10px' }}>
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
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = '#e9f5ff')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = 'transparent')
                      }
                    >
                      {opened[key] ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                      {key}
                    </Button>
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
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = '#f8f9fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = 'transparent')
                  }
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
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }
  } else {
    return null;
  }
}

export default NestedCollapses;
