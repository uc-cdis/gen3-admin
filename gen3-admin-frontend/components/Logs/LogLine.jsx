import { Group, Text, Code } from '@mantine/core';

import {format } from 'date-fns';

export default function LogLine({ log, highlighted, sx }) {

  return (
    <div style={sx}>
      <Group grow wrap="nowrap">

        <Code >{format(new Date(log.timestamp), "PPpp")}: {log.message}</Code>
      </Group>
    </div>
  );
};

// export default LogLine;