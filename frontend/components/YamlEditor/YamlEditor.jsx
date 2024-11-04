"use client";

import { useState } from "react";

import Editor from "@monaco-editor/react";

import YAML from 'yaml';

import { useViewportSize } from '@mantine/hooks';

import { Button, Container, Group, useMantineColorScheme } from '@mantine/core';


export default function YamlEditor({ data, setData }) {
    const { height, width } = useViewportSize();
    const { colorScheme, setColorScheme } = useMantineColorScheme();

    const isDarkMode = colorScheme === 'dark';

    return (
        <div>
            <Container fluid size="lg" p="md" radius="md" my="md">
                <Container fluid size="sm" p="md" radius="md" my="md">
                    <Button disabled>Save</Button>
                </Container>
                <Editor
                    dark={true}
                    className='border rounded-lg h-screen'
                    value={YAML.stringify(data, null, 2)}
                    defaultLanguage='yaml'
                    onChange={setData}
                    height={height}
                    theme={isDarkMode ? 'vs-dark' : 'light'} // Dynamically set theme based on color scheme
                    // theme={getSystemTheme()}
                    options={{
                        minimap: {
                            enabled: false,
                        },
                    }}
                />
            </Container>
        </div>
    )
}