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
    TextVariants
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

const UploadButton = ({ path, addAlert }) => {
    const BLOCK_SIZE = 16 * 1024;
    const PING_COUNTER = 128;
    const ref = useRef();
    const currentDir = path.join("/") + "/";
    const [isUploading, setIsUploading] = useState(false);

    const handleClick = () => {
        ref.current.click();
    };

    const onUpload = event => {
        setIsUploading(true);
        console.log(event.target.files);
        for (let fileIndex = 0; fileIndex < event.target.files.length; fileIndex++) {
            const uploadedFile = event.target.files[fileIndex];
            const numberofChunks = Math.ceil(uploadedFile.size / BLOCK_SIZE);
            console.log(numberofChunks);
            const fileName = uploadedFile.name;
            let pingCounter = PING_COUNTER;

            // TODO: do I need to wait on the open message?
            const channel = cockpit.channel({
                binary: true,
                payload: "fsreplace1",
                path: `${currentDir}/${fileName}`,
                superuser: "try"
            });

            const uploadChunk = (chunk_start) => {
                const chunk_next = chunk_start + BLOCK_SIZE;
                const reader = new FileReader();

                reader.onload = readerEvent => {
                    // channel.send(new window.Uint8Array(blob));
                    channel.send(readerEvent.target.result);
                };

                // reader.onprogress = event => {
                //     console.log("progress", event);
                // };

                reader.onloadend = (event) => {
                    if (chunk_next <= uploadedFile.size) {
                        // should be if uploadCounter > 0
                        uploadChunk(chunk_next);
                        console.log("go ping");
                        channel.control({ command: "ping" });
                        pingCounter = pingCounter - 1;
                    } else {
                        console.log("loadend", event);
                        channel.control({ command: "done" });
                    }
                };

                const blob = uploadedFile.slice(chunk_start, chunk_next);
                console.log("blob", blob);
                reader.readAsArrayBuffer(blob);
            };

            channel.addEventListener("control", function(_event, message) {
                console.log("control", message);
                // pongCounter += 1;
            });

            channel.addEventListener("message", function(_event, message) {
                console.log("message", message);
                // pongCounter += 1;
            });

            channel.addEventListener("close", function(_event, message) {
                console.log("close", _event, message);
                if (message?.problem === "not-found") {
                    addAlert(cockpit.format(_("Cannot upload to $0"), currentDir),
                             AlertVariant.danger, "upload-error");
                } else if (message?.problem === "access-denied") {
                    addAlert(cockpit.format(_("No permission to upload to $0"), currentDir),
                             AlertVariant.danger, "upload-error");
                } else if (message?.tag.startsWith("1:")) {
                    addAlert(cockpit.format(_("Succesfully uploaded $0"), fileName),
                             AlertVariant.success, "upload-success");
                } else {
                    addAlert(cockpit.format(_("Error during upload of $0"), fileName),
                             AlertVariant.danger, "upload-error");
                }
                setIsUploading(false);
            });

            // reader.onprogress = event => {
            //     console.log("progress", event);
            // };
            //
            // // reader.onload = readerEvent => {
            // //     let len = 0;
            // //     const content = readerEvent.target.result;
            // //     console.log(content);
            // //     len = content.byteLength;
            // //
            // //     for (let i = 0; i < len; i += BLOCK_SIZE) {
            // //         const n = Math.min(len - i, BLOCK_SIZE);
            // //         channel.send(new window.Uint8Array(content, i, n));
            // //     }
            // // };
            //
            // reader.onloadend = event => {
            //     // TODO: check for errors?
            //     // event.target.readyState !== FileReader.DONE
            //     console.log("loadend", event);
            //     channel.control({ command: "done" });
            // };

            // Start uploading
            uploadChunk(0);
        }
    };

    return (
        <>
            <Button
              variant="secondary" icon={<UploadIcon />}
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
