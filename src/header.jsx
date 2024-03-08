/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React, { useRef, useState } from "react";

import {
    AlertVariant,
    Button,
    CardHeader,
    CardTitle,
    Flex,
    MenuToggle,
    MenuToggleAction,
    SearchInput,
    Select,
    SelectList,
    SelectOption,
    Text,
    TextContent,
    TextVariants,
    Icon,
} from "@patternfly/react-core";
import { GripVerticalIcon, ListIcon, UploadIcon } from "@patternfly/react-icons";

const _ = cockpit.gettext;

export const NavigatorCardHeader = ({
    currentFilter, onFilterChange, isGrid, setIsGrid, sortBy, setSortBy, path, addAlert
}) => {
    return (
        <CardHeader className="card-actionbar">
            <CardTitle component="h2" id="navigator-card-header">
                <TextContent>
                    <Text component={TextVariants.h2}>
                        {_("Directories & files")}
                    </Text>
                </TextContent>
            </CardTitle>
            <Flex flexWrap={{ default: "nowrap" }} alignItems={{ default: "alignItemsCenter" }}>
                <SearchInput
                  placeholder={_("Filter directory")} value={currentFilter}
                  onChange={onFilterChange}
                />
                <ViewSelector
                  isGrid={isGrid} setIsGrid={setIsGrid}
                  setSortBy={setSortBy} sortBy={sortBy}
                />
                <UploadButton
                  path={path}
                  addAlert={addAlert}
                />
            </Flex>
        </CardHeader>
    );
};

const ViewSelector = ({ isGrid, setIsGrid, sortBy, setSortBy }) => {
    const [isOpen, setIsOpen] = useState(false);
    const onToggleClick = isOpen => setIsOpen(!isOpen);
    const onSelect = (ev, itemId) => {
        setIsOpen(false);
        setSortBy(itemId);
        localStorage.setItem("cockpit-navigator.sort", itemId);
    };

    return (
        <Select
          id="sort-menu"
          isOpen={isOpen}
          selected={sortBy}
          onSelect={onSelect}
          onOpenChange={setIsOpen}
          popperProps={{ position: "right" }}
          toggle={toggleRef => (
              <MenuToggle
                id="sort-menu-toggle"
                className="view-toggle-group"
                isExpanded={isOpen}
                onClick={() => onToggleClick(isOpen)}
                ref={toggleRef}
                splitButtonOptions={{
                    variant: "action",
                    items: [
                        <MenuToggleAction
                          aria-label={isGrid
                              ? _("Display as a list")
                              : _("Display as a grid")}
                          key="view-toggle-action"
                          onClick={() => setIsGrid(!isGrid)}
                        >
                            {isGrid
                                ? <ListIcon className="view-toggle-icon" />
                                : <GripVerticalIcon className="view-toggle-icon" />}
                        </MenuToggleAction>
                    ]
                }}
                variant="secondary"
              />
          )}
        >
            <SelectList>
                <SelectOption itemId="az">{_("A-Z")}</SelectOption>
                <SelectOption itemId="za">{_("Z-A")}</SelectOption>
                <SelectOption itemId="last_modified">{_("Last modified")}</SelectOption>
                <SelectOption itemId="first_modified">{_("First modified")}</SelectOption>
            </SelectList>
        </Select>
    );
};

const readFile = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
});

const UploadButton = ({ path, addAlert }) => {
    const BLOCK_SIZE = 16 * 1024;
    const PING_COUNTER = 128;
    const ref = useRef();
    const currentDir = path.join("/") + "/";
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);

    const handleClick = () => {
        ref.current.click();
    };

    const waitPromise = (channel, file) => new Promise((resolve, reject) => {
        function on_control(event, message) {
            console.log("close", message);
            if (message?.problem === "not-found") {
                addAlert(cockpit.format(_("Cannot upload to $0"), currentDir),
                         AlertVariant.danger, "upload-error");
            } else if (message?.problem === "access-denied") {
                addAlert(cockpit.format(_("No permission to upload to $0"), currentDir),
                         AlertVariant.danger, "upload-error");
            } else if (message?.tag.startsWith("1:")) {
                addAlert(cockpit.format(_("Succesfully uploaded $0"), file.name),
                         AlertVariant.success, "upload-success");
            } else {
                addAlert(cockpit.format(_("Error during upload of $0"), file.name),
                         AlertVariant.danger, "upload-error");
            }
            setIsUploading(false);
            setProgress(0);
            channel.removeEventListener("close", on_control);
            resolve("yay");
        }
        channel.addEventListener("close", on_control);
    });

    const onUpload = async event => {
        setProgress(0);
        setIsUploading(true);
        console.log(event.target.files);

        // We only support one file upload
        const file = event.target.files[0];

        // Open fsreplace1 channel
        const channel = cockpit.channel({
            binary: true,
            payload: "fsreplace1",
            path: `${currentDir}/${file.name}`,
            superuser: "try"
        });

        const queuingStrategy = new CountQueuingStrategy({ highWaterMark: 128 });
        const writableStream = new WritableStream(
            {
                // Implement the sink
                write(chunk) {
                    return new Promise((resolve, reject) => {
                        function handleAck(event, message) {
                            console.log("handleAck", message);
                            if (message.command === "ack") {
                                channel.removeEventListener("control", handleAck);
                                resolve();
                            }
                        }

                        channel.addEventListener("control", handleAck);
                        channel.send(chunk);
                    });
                },
                close() {
                    console.log("closing writeable stream");
                },
                abort(err) {
                    console.error("Sink error:", err);
                },
            },
            queuingStrategy,
        );

        const defaultWriter = writableStream.getWriter();

        let chunk_start = 0;
        while (chunk_start <= file.size) {
            // TODO: less fine grained? This re-renders an awful lot
            const progress = Math.floor((chunk_start / file.size) * 100);
            setProgress(progress);
            console.log(chunk_start, file.size, progress);
            const chunk_next = chunk_start + BLOCK_SIZE;
            const blob = file.slice(chunk_start, chunk_next);
            const chunk = await readFile(blob);
            await defaultWriter.ready;
            await defaultWriter.write(chunk);
            chunk_start = chunk_next;
        }

        channel.control({ command: "done" });
        await waitPromise(channel, file);
        channel.close();
    };

    let icon = <UploadIcon />;
    if (isUploading) {
        icon = (
            <Icon className="progress-wrapper">
                <div
                  id="progress" className="progress-pie"
                  title={`Upload ${progress}% completed`} style={{ "--progress": `${progress}%` }}
                />
            </Icon>
        );
    }

    return (
        <>
            <Button
              variant="secondary" icon={icon}
              isDisabled={isUploading}
              onClick={handleClick}
            >
                {_("Upload")}
            </Button>
            <input
              ref={ref} type="file"
              hidden onChange={onUpload}
            />
        </>
    );
};
